-- CreateTable
CREATE TABLE "ops_member_links" (
    "discordUserId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "accountRole" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_member_links_pkey" PRIMARY KEY ("discordUserId")
);

-- CreateTable
CREATE TABLE "ops_verification_events" (
    "id" SERIAL NOT NULL,
    "discordUserId" TEXT,
    "memberId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_webhook_events" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ops_member_links_memberId_key" ON "ops_member_links"("memberId");

-- CreateIndex
CREATE INDEX "ops_verification_events_discordUserId_idx" ON "ops_verification_events"("discordUserId");

-- CreateIndex
CREATE INDEX "ops_verification_events_memberId_idx" ON "ops_verification_events"("memberId");

