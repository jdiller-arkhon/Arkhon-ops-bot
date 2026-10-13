import { arkhonEmbed, parseProduct, productLabel, truncate, type Product } from '@arkhon/shared';
import {
  ChannelType,
  type AnyThreadChannel,
  type ForumChannel,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from 'discord.js';
import type { OpsContext } from '../context.js';
import { isUniqueViolation } from '../db.js';
import { isStaff } from '../permissions.js';
import { createGithubIssue } from './github.js';

export const FEEDBACK_LABEL = 'community-feedback';

/** Product from a forum post's applied tags (tags named "Certa" / "Argus", case-insensitive). */
export function productFromTags(
  appliedTagIds: readonly string[],
  availableTags: readonly { id: string; name: string }[],
): Product | undefined {
  const products = new Set<Product>();
  for (const tag of availableTags) {
    if (!appliedTagIds.includes(tag.id)) continue;
    const product = parseProduct(tag.name);
    if (product) products.add(product);
  }
  return products.size === 1 ? [...products][0] : undefined;
}

/** True when the reaction emoji matches FEEDBACK_PROMOTE_EMOJI (unicode, name, or custom id). */
export function emojiMatches(
  emoji: { id: string | null; name: string | null },
  configured: string,
): boolean {
  const wanted = configured.trim();
  if (emoji.id && (wanted === emoji.id || wanted.includes(`:${emoji.id}>`))) return true;
  return emoji.name !== null && (emoji.name === wanted || `:${emoji.name}:` === wanted);
}

function isFeedbackThread(channel: unknown, forumId: string): channel is AnyThreadChannel {
  const thread = channel as AnyThreadChannel | null;
  return Boolean(
    thread &&
    typeof thread.isThread === 'function' &&
    thread.isThread() &&
    thread.parentId === forumId,
  );
}

async function forumParent(thread: AnyThreadChannel): Promise<ForumChannel | null> {
  const parent =
    thread.parent ?? (await thread.guild.channels.fetch(thread.parentId ?? '').catch(() => null));
  return parent && parent.type === ChannelType.GuildForum ? parent : null;
}

/** New posts without exactly one product tag get a reminder. */
export async function onFeedbackThreadCreate(
  thread: AnyThreadChannel,
  newlyCreated: boolean,
  ctx: OpsContext,
) {
  const layout = ctx.layout.current;
  if (!layout || !newlyCreated || !isFeedbackThread(thread, layout.channels.feedbackForum)) return;
  const forum = await forumParent(thread);
  if (!forum) return;
  if (productFromTags(thread.appliedTags, forum.availableTags)) return;
  await thread.send({
    content: `<@${thread.ownerId}> please tag this post with **Certa** or **Argus** (exactly one) so the right team sees it. Use "Edit Tags" from the post menu.`,
    allowedMentions: { users: thread.ownerId ? [thread.ownerId] : [] },
  });
}

/**
 * Staff reacting with the promote emoji on a feedback post's starter message turns the post into
 * a GitHub issue in the product's repo and replies in the thread with the link.
 */
export async function onFeedbackReaction(
  reactionInput: MessageReaction | PartialMessageReaction,
  userInput: User | PartialUser,
  ctx: OpsContext,
): Promise<void> {
  const { config, logger } = ctx;
  const layout = ctx.layout.current;
  if (!layout) return;
  if (!emojiMatches(reactionInput.emoji, config.feedback.promoteEmoji)) return;
  if (userInput.bot) return;

  const reaction = reactionInput.partial ? await reactionInput.fetch() : reactionInput;
  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  const thread = message.channel;
  if (!isFeedbackThread(thread, layout.channels.feedbackForum)) return;
  // Only the starter message (its id equals the thread id) represents the post.
  if (message.id !== thread.id) return;

  const member = await thread.guild.members.fetch(userInput.id).catch(() => null);
  if (!member || !isStaff(member, layout)) return;

  const forum = await forumParent(thread);
  const product = forum ? productFromTags(thread.appliedTags, forum.availableTags) : undefined;
  if (!product) {
    await thread.send(
      `${member}, this post needs exactly one **Certa** or **Argus** tag before it can be promoted.`,
    );
    return;
  }
  if (!isStaff(member, layout, product)) return;

  const repo = config.feedback.repos[product];
  const token = config.feedback.githubToken;
  if (!repo || !token) {
    await thread.send(
      `${member}, no GitHub repository is configured for ${productLabel(product)} feedback.`,
    );
    logger.warn({ product }, 'feedback promotion attempted but no repo configured');
    return;
  }

  // Claim the thread first so concurrent reactions cannot create duplicate issues.
  try {
    await ctx.prisma.opsFeedbackIssue.create({
      data: { threadId: thread.id, product, repo, promotedById: member.id },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return;
    throw error;
  }

  try {
    const author = message.author;
    const postUrl = `https://discord.com/channels/${thread.guildId}/${thread.id}`;
    const body = [
      message.content || '_No text in the original post._',
      ...message.attachments.map((a) => `- Attachment: ${a.url}`),
      '',
      '---',
      `Submitted by **${author.username}** in the Arkhon community Discord: ${postUrl}`,
      `Promoted by **${member.user.username}**.`,
    ].join('\n');

    const issue = await createGithubIssue({
      token,
      repo,
      title: truncate(thread.name, 256),
      body,
      labels: [product, FEEDBACK_LABEL],
    });
    await ctx.prisma.opsFeedbackIssue.update({
      where: { threadId: thread.id },
      data: { issueNumber: issue.number, issueUrl: issue.url },
    });
    await thread.send({
      embeds: [
        arkhonEmbed({
          product,
          title: `Tracked as ${repo}#${issue.number}`,
          description: `Thanks for the feedback! The ${productLabel(product)} team is tracking this here: ${issue.url}`,
          url: issue.url,
        }),
      ],
    });
    logger.info(
      { threadId: thread.id, product, repo, issue: issue.number, staffId: member.id },
      'feedback promoted',
    );
  } catch (error) {
    await ctx.prisma.opsFeedbackIssue
      .delete({ where: { threadId: thread.id } })
      .catch(() => undefined);
    logger.error({ err: error, threadId: thread.id, repo }, 'feedback promotion failed');
    await thread
      .send(
        `${member}, creating the GitHub issue failed. Check the bot logs, then react again to retry.`,
      )
      .catch(() => undefined);
  }
}
