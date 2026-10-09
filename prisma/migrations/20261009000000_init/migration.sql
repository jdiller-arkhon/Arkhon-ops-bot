-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "ops_tickets" (
    "id" SERIAL NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstStaffReplyAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ops_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_panels" (
    "key" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_panels_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ops_mod_actions" (
    "id" SERIAL NOT NULL,
    "guildId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "durationMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_mod_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_releases" (
    "id" SERIAL NOT NULL,
    "product" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_feedback_issues" (
    "id" SERIAL NOT NULL,
    "threadId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "issueNumber" INTEGER,
    "issueUrl" TEXT,
    "promotedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_feedback_issues_pkey" PRIMARY KEY ("id")
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

