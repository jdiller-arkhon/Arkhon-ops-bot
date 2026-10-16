-- CreateTable
CREATE TABLE "certa_links" (
    "discordUserId" TEXT NOT NULL PRIMARY KEY,
    "certaUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "certa_reminder_sends" (
    "discordUserId" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "thresholdDays" INTEGER NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("discordUserId", "dueDate", "thresholdDays")
);

-- CreateTable
CREATE TABLE "certa_shared_flights" (
    "flightId" TEXT NOT NULL PRIMARY KEY,
    "discordUserId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "publicLocation" TEXT NOT NULL,
    "aircraft" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "missionType" TEXT NOT NULL,
    "sharedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "certa_job_runs" (
    "job" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("job", "runKey")
);

-- CreateTable
CREATE TABLE "certa_mock_users" (
    "certaUserId" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "lastTrainingDate" TEXT,
    "lastTrainingKind" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "certa_mock_link_codes" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "certaUserId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "redeemedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "certa_mock_flights" (
    "flightId" TEXT NOT NULL PRIMARY KEY,
    "certaUserId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "locationIsIcao" BOOLEAN NOT NULL,
    "aircraft" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "missionType" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "certa_links_certaUserId_key" ON "certa_links"("certaUserId");

-- CreateIndex
CREATE INDEX "certa_shared_flights_discordUserId_idx" ON "certa_shared_flights"("discordUserId");

-- CreateIndex
CREATE INDEX "certa_mock_flights_certaUserId_date_idx" ON "certa_mock_flights"("certaUserId", "date");

-- CreateIndex
CREATE INDEX "certa_mock_flights_date_idx" ON "certa_mock_flights"("date");

