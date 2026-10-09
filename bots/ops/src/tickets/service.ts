import {
  arkhonEmbed,
  isProduct,
  productLabel,
  truncate,
  UserFacingError,
  type Product,
} from '@arkhon/shared';
import type { OpsTicket } from '@prisma/client';
import {
  AttachmentBuilder,
  ChannelType,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { OpsContext } from '../context.js';
import { TICKET_FIELDS } from '../ids.js';
import { requireGuildMember, requireStaff, isStaff } from '../permissions.js';
import { buildStaffControls, buildTicketModal } from './panel.js';
import { isTicketStatus, nextStatus, type TicketAction, type TicketStatus } from './state.js';
import { formatTranscript, type TranscriptMessage } from './transcript.js';

/** Max staff members explicitly added to a private ticket thread (the role is also @mentioned). */
const MAX_STAFF_THREAD_ADDS = 25;
/** Safety cap for transcript size. */
const MAX_TRANSCRIPT_MESSAGES = 5000;

/**
 * Channel ids of tickets that are not closed. Lets the messageCreate handler skip the database
 * for every message outside a ticket.
 */
const activeTicketChannels = new Set<string>();

export async function loadActiveTicketChannels(ctx: OpsContext): Promise<number> {
  const tickets = await ctx.prisma.opsTicket.findMany({
    where: { status: { in: ['open', 'waiting'] }, channelId: { not: null } },
    select: { channelId: true },
  });
  activeTicketChannels.clear();
  for (const ticket of tickets) if (ticket.channelId) activeTicketChannels.add(ticket.channelId);
  return activeTicketChannels.size;
}

function ticketStatus(ticket: OpsTicket): TicketStatus {
  if (!isTicketStatus(ticket.status))
    throw new Error(`Ticket ${ticket.id} has bad status ${ticket.status}`);
  return ticket.status;
}

function ticketProduct(ticket: OpsTicket): Product {
  if (!isProduct(ticket.product))
    throw new Error(`Ticket ${ticket.id} has bad product ${ticket.product}`);
  return ticket.product;
}

function channelUrl(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function ticketChannelName(ticketId: number, product: Product, username: string): string {
  const slug = username
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return truncate(`${product}-${String(ticketId).padStart(4, '0')}-${slug || 'user'}`, 100, '');
}

async function findOpenTicket(ctx: OpsContext, userId: string, product: Product) {
  return ctx.prisma.opsTicket.findFirst({
    where: { userId, product, status: { in: ['open', 'waiting'] }, channelId: { not: null } },
  });
}

// ---------------------------------------------------------------- opening

export async function showTicketModal(
  interaction: ButtonInteraction,
  product: Product,
  ctx: OpsContext,
): Promise<void> {
  requireGuildMember(interaction, ctx.config);
  const existing = await findOpenTicket(ctx, interaction.user.id, product);
  if (existing?.channelId) {
    throw new UserFacingError(
      `You already have an open ${productLabel(product)} ticket: ${channelUrl(existing.guildId, existing.channelId)}`,
    );
  }
  await interaction.showModal(buildTicketModal(product));
}

export async function createTicketFromModal(
  interaction: ModalSubmitInteraction,
  product: Product,
  ctx: OpsContext,
): Promise<void> {
  const member = requireGuildMember(interaction, ctx.config);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const existing = await findOpenTicket(ctx, member.id, product);
  if (existing?.channelId) {
    throw new UserFacingError(
      `You already have an open ${productLabel(product)} ticket: ${channelUrl(existing.guildId, existing.channelId)}`,
    );
  }

  const subject = interaction.fields.getTextInputValue(TICKET_FIELDS.subject).trim();
  const description = interaction.fields.getTextInputValue(TICKET_FIELDS.description).trim();
  const appVersion = interaction.fields.getTextInputValue(TICKET_FIELDS.appVersion).trim() || null;

  const ticket = await ctx.prisma.opsTicket.create({
    data: {
      guildId: member.guild.id,
      product,
      userId: member.id,
      subject,
      description,
      appVersion,
    },
  });

  let channel: GuildTextBasedChannel;
  let kind: 'thread' | 'channel';
  try {
    ({ channel, kind } = await createTicketChannel(ctx, member, ticket.id, product));
  } catch (error) {
    await ctx.prisma.opsTicket.delete({ where: { id: ticket.id } });
    throw error;
  }

  await ctx.prisma.opsTicket.update({
    where: { id: ticket.id },
    data: { channelId: channel.id, channelKind: kind },
  });
  activeTicketChannels.add(channel.id);

  const staffRoleId = ctx.config.roles.staff[product];
  const embed = arkhonEmbed({
    product,
    title: `Ticket #${ticket.id}: ${subject}`,
    description,
    fields: [
      { name: 'Opened by', value: `${member}`, inline: true },
      { name: 'App version', value: appVersion ?? 'not provided', inline: true },
      { name: 'Status', value: 'Open', inline: true },
    ],
    timestamp: true,
  });
  await channel.send({
    content: `${member} thanks for reaching out. <@&${staffRoleId}> will be with you shortly.`,
    embeds: [embed],
    components: [buildStaffControls(ticket.id)],
    allowedMentions: { users: [member.id], roles: [staffRoleId] },
  });

  ctx.logger.info(
    { ticketId: ticket.id, product, userId: member.id, channelId: channel.id, kind },
    'ticket opened',
  );
  await interaction.editReply(`Your ticket is open: ${channel}`);
}

async function createTicketChannel(
  ctx: OpsContext,
  member: GuildMember,
  ticketId: number,
  product: Product,
): Promise<{ channel: GuildTextBasedChannel; kind: 'thread' | 'channel' }> {
  const guild = member.guild;
  const name = ticketChannelName(ticketId, product, member.user.username);
  if (ctx.config.tickets.mode === 'thread') {
    const thread = await createPrivateThread(ctx, guild, member, name, product).catch(
      (error: unknown) => {
        ctx.logger.warn(
          { err: error, ticketId },
          'private thread unavailable, falling back to a private channel',
        );
        return null;
      },
    );
    if (thread) return { channel: thread, kind: 'thread' };
  }
  return {
    channel: await createPrivateChannel(ctx, guild, member, name, product),
    kind: 'channel',
  };
}

async function createPrivateThread(
  ctx: OpsContext,
  guild: Guild,
  member: GuildMember,
  name: string,
  product: Product,
): Promise<GuildTextBasedChannel> {
  const support = await guild.channels.fetch(ctx.config.channels.support);
  if (!support || support.type !== ChannelType.GuildText) {
    throw new Error('SUPPORT_CHANNEL_ID must be a text channel to host private threads');
  }
  const me = guild.members.me;
  const perms = me ? support.permissionsFor(me) : null;
  if (
    !perms?.has([
      PermissionFlagsBits.CreatePrivateThreads,
      PermissionFlagsBits.SendMessagesInThreads,
    ])
  ) {
    throw new Error(
      'Bot lacks Create Private Threads / Send Messages in Threads in the support channel',
    );
  }

  const thread = await support.threads.create({
    name,
    type: ChannelType.PrivateThread,
    invitable: false,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: `Support ticket for ${member.user.tag}`,
  });
  await thread.members.add(member.id);

  // Private threads cannot be shared with a role directly. The opening message @mentions the
  // staff role (which adds its members), and cached staff members are added explicitly as well.
  const staffRole = guild.roles.cache.get(ctx.config.roles.staff[product]);
  const staff = staffRole ? [...staffRole.members.values()].filter((m) => !m.user.bot) : [];
  for (const staffMember of staff.slice(0, MAX_STAFF_THREAD_ADDS)) {
    await thread.members.add(staffMember.id).catch((error: unknown) => {
      ctx.logger.warn(
        { err: error, userId: staffMember.id },
        'could not add staff member to ticket thread',
      );
    });
  }
  return thread;
}

async function createPrivateChannel(
  ctx: OpsContext,
  guild: Guild,
  member: GuildMember,
  name: string,
  product: Product,
): Promise<GuildTextBasedChannel> {
  const me = guild.members.me;
  if (!me) throw new Error('Bot member is not cached');
  const participant = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks,
  ];
  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: ctx.config.tickets.categoryId ?? null,
    topic: `${productLabel(product)} support ticket for ${member.user.tag}`,
    reason: `Support ticket for ${member.user.tag}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        type: OverwriteType.Role,
        deny: [PermissionFlagsBits.ViewChannel],
      },
      { id: member.id, type: OverwriteType.Member, allow: participant },
      {
        id: ctx.config.roles.staff[product],
        type: OverwriteType.Role,
        allow: [...participant, PermissionFlagsBits.ManageMessages],
      },
      {
        id: me.id,
        type: OverwriteType.Member,
        allow: [...participant, PermissionFlagsBits.ManageChannels],
      },
    ],
  });
}

// ---------------------------------------------------------------- staff actions

export type StaffAction = Extract<TicketAction, 'claim' | 'markWaiting' | 'close'>;

export async function handleStaffAction(
  interaction: ButtonInteraction,
  action: StaffAction,
  ticketId: number,
  ctx: OpsContext,
): Promise<void> {
  const ticket = await ctx.prisma.opsTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new UserFacingError(`Ticket #${ticketId} no longer exists.`);
  const product = ticketProduct(ticket);
  const staff = requireStaff(interaction, ctx.config, product);
  const from = ticketStatus(ticket);

  let to: TicketStatus;
  try {
    to = nextStatus(from, action);
  } catch (error) {
    throw new UserFacingError((error as Error).message);
  }

  if (action === 'close') {
    await closeTicket(interaction, ticket, staff, ctx);
    return;
  }

  if (action === 'claim' && ticket.claimedById === staff.id) {
    throw new UserFacingError('You have already claimed this ticket.');
  }

  const result = await ctx.prisma.opsTicket.updateMany({
    where: { id: ticket.id, status: from },
    data: action === 'claim' ? { status: to, claimedById: staff.id } : { status: to },
  });
  if (result.count === 0) throw new UserFacingError('This ticket just changed. Please try again.');

  ctx.logger.info({ ticketId, action, from, to, staffId: staff.id }, 'ticket updated');
  if (action === 'claim') {
    await interaction.reply({
      content: `🙋 ${staff} claimed this ticket${ticket.claimedById ? ` (previously <@${ticket.claimedById}>)` : ''}.`,
      allowedMentions: { parse: [] },
    });
  } else {
    await interaction.reply({
      content: `⏳ <@${ticket.userId}>, the team is waiting on your reply. The ticket reopens automatically when you respond.`,
      allowedMentions: { users: [ticket.userId] },
    });
  }
}

async function closeTicket(
  interaction: ButtonInteraction,
  ticket: OpsTicket,
  staff: GuildMember,
  ctx: OpsContext,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const product = ticketProduct(ticket);
  const closedAt = new Date();
  const result = await ctx.prisma.opsTicket.updateMany({
    where: { id: ticket.id, status: { in: ['open', 'waiting'] } },
    data: { status: 'closed', closedAt, closedById: staff.id },
  });
  if (result.count === 0) throw new UserFacingError('This ticket is already closed.');
  if (ticket.channelId) activeTicketChannels.delete(ticket.channelId);

  const channel = interaction.channel;
  if (!channel || channel.isDMBased())
    throw new Error('Ticket close clicked outside a guild channel');

  const [opener, claimer, messages] = await Promise.all([
    ctx.client.users.fetch(ticket.userId).catch(() => null),
    ticket.claimedById ? ctx.client.users.fetch(ticket.claimedById).catch(() => null) : null,
    fetchTranscriptMessages(channel),
  ]);
  const transcript = formatTranscript(
    {
      id: ticket.id,
      product,
      subject: ticket.subject,
      description: ticket.description,
      appVersion: ticket.appVersion,
      userId: ticket.userId,
      userTag: opener?.tag ?? ticket.userId,
      createdAt: ticket.createdAt,
      closedAt,
      closedByTag: staff.user.tag,
      claimedByTag: claimer?.tag ?? (ticket.claimedById ? ticket.claimedById : null),
    },
    messages,
  );
  const fileName = `ticket-${ticket.id}-${product}.txt`;
  const file = () => new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: fileName });

  let dmDelivered = false;
  if (opener) {
    try {
      await opener.send({
        embeds: [
          arkhonEmbed({
            product,
            title: `Your ${productLabel(product)} ticket #${ticket.id} was closed`,
            description: `**${ticket.subject}**\n\nA full transcript is attached. If you still need help, open a new ticket from the support channel.`,
          }),
        ],
        files: [file()],
      });
      dmDelivered = true;
    } catch (error) {
      ctx.logger.info(
        { err: error, ticketId: ticket.id, userId: ticket.userId },
        'could not DM transcript',
      );
    }
  }

  const archive = await ctx.client.channels.fetch(ctx.config.channels.ticketArchive);
  if (archive?.isSendable()) {
    await archive.send({
      embeds: [
        arkhonEmbed({
          product,
          title: `Ticket #${ticket.id} closed: ${ticket.subject}`,
          fields: [
            { name: 'User', value: `<@${ticket.userId}>`, inline: true },
            {
              name: 'Claimed by',
              value: ticket.claimedById ? `<@${ticket.claimedById}>` : 'unclaimed',
              inline: true,
            },
            { name: 'Closed by', value: `${staff}`, inline: true },
            { name: 'Messages', value: String(messages.length), inline: true },
            {
              name: 'Transcript DM',
              value: dmDelivered ? 'delivered' : 'failed (DMs closed)',
              inline: true,
            },
          ],
          timestamp: closedAt,
        }),
      ],
      files: [file()],
      allowedMentions: { parse: [] },
    });
  } else {
    ctx.logger.error(
      { channelId: ctx.config.channels.ticketArchive },
      'ticket archive channel unavailable',
    );
  }

  ctx.logger.info(
    { ticketId: ticket.id, staffId: staff.id, messages: messages.length, dmDelivered },
    'ticket closed',
  );
  await interaction.editReply(
    `Ticket closed. Transcript ${dmDelivered ? 'sent to the user and ' : ''}posted to <#${ctx.config.channels.ticketArchive}>.`,
  );
  await channel.send({ content: `🔒 Ticket closed by ${staff}.`, allowedMentions: { parse: [] } });

  if (channel.isThread()) {
    await channel.setLocked(true, 'Ticket closed');
    await channel.setArchived(true, 'Ticket closed');
  } else {
    // Private channels are removed once the transcript is safely archived.
    await channel.delete(`Ticket #${ticket.id} closed`);
  }
}

async function fetchTranscriptMessages(
  channel: GuildTextBasedChannel,
): Promise<TranscriptMessage[]> {
  const collected: Message[] = [];
  let before: string | undefined;
  while (collected.length < MAX_TRANSCRIPT_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    collected.push(...batch.values());
    before = batch.lastKey();
    if (batch.size < 100) break;
  }
  return collected.map((message) => ({
    authorTag: message.author.tag,
    authorId: message.author.id,
    bot: message.author.bot,
    createdAt: message.createdAt,
    content: message.content,
    attachments: message.attachments.map((attachment) => attachment.url),
    embeds: message.embeds
      .map((embed) => [embed.title, embed.description].filter(Boolean).join(' — '))
      .filter((text) => text.length > 0),
  }));
}

// ---------------------------------------------------------------- message tracking

/**
 * Called for every guild message. Records the first staff reply and moves a ticket back to
 * "open" when the user answers while it is waiting on them.
 */
export async function onTicketMessage(message: Message, ctx: OpsContext): Promise<void> {
  if (message.author.bot || !message.inGuild() || !activeTicketChannels.has(message.channelId))
    return;

  const ticket = await ctx.prisma.opsTicket.findUnique({ where: { channelId: message.channelId } });
  if (!ticket || ticket.status === 'closed') return;
  const product = ticketProduct(ticket);

  if (message.author.id === ticket.userId) {
    if (ticket.status === 'waiting') {
      const to = nextStatus('waiting', 'userReply');
      await ctx.prisma.opsTicket.updateMany({
        where: { id: ticket.id, status: 'waiting' },
        data: { status: to },
      });
      ctx.logger.info(
        { ticketId: ticket.id, from: 'waiting', to },
        'ticket reopened by user reply',
      );
    }
    return;
  }

  if (ticket.firstStaffReplyAt) return;
  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (member && isStaff(member, ctx.config, product)) {
    await ctx.prisma.opsTicket.updateMany({
      where: { id: ticket.id, firstStaffReplyAt: null },
      data: { firstStaffReplyAt: message.createdAt },
    });
  }
}
