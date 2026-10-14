-- CreateTable
CREATE TABLE "ops_tickets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "channelKind" TEXT NOT NULL DEFAULT 'thread',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "appVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "claimedById" TEXT,
    "closedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstStaffReplyAt" DATETIME,
    "closedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ops_panels" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ops_server_resources" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ops_mod_actions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "durationMinutes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ops_releases" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "product" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "messageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ops_feedback_issues" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "threadId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "issueNumber" INTEGER,
    "issueUrl" TEXT,
    "promotedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ops_member_links" (
    "discordUserId" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "accountRole" TEXT,
    "linkedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ops_verification_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "discordUserId" TEXT,
    "memberId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ops_webhook_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ops_tickets_channelId_key" ON "ops_tickets"("channelId");

-- CreateIndex
CREATE INDEX "ops_tickets_product_status_idx" ON "ops_tickets"("product", "status");

-- CreateIndex
CREATE INDEX "ops_tickets_userId_product_status_idx" ON "ops_tickets"("userId", "product", "status");

-- CreateIndex
CREATE INDEX "ops_mod_actions_guildId_targetId_idx" ON "ops_mod_actions"("guildId", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ops_releases_product_version_key" ON "ops_releases"("product", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ops_feedback_issues_threadId_key" ON "ops_feedback_issues"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "ops_member_links_memberId_key" ON "ops_member_links"("memberId");

-- CreateIndex
CREATE INDEX "ops_verification_events_discordUserId_idx" ON "ops_verification_events"("discordUserId");

-- CreateIndex
CREATE INDEX "ops_verification_events_memberId_idx" ON "ops_verification_events"("memberId");

