-- CreateTable
CREATE TABLE "certa_links" (
    "discordUserId" TEXT NOT NULL,
    "certaUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certa_links_pkey" PRIMARY KEY ("discordUserId")
);

-- CreateTable
CREATE TABLE "certa_reminder_sends" (
    "discordUserId" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "thresholdDays" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certa_reminder_sends_pkey" PRIMARY KEY ("discordUserId","dueDate","thresholdDays")
);

-- CreateTable
CREATE TABLE "certa_shared_flights" (
    "flightId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "publicLocation" TEXT NOT NULL,
    "aircraft" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "missionType" TEXT NOT NULL,
    "sharedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certa_shared_flights_pkey" PRIMARY KEY ("flightId")
);

-- CreateTable
CREATE TABLE "certa_job_runs" (
    "job" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certa_job_runs_pkey" PRIMARY KEY ("job","runKey")
);

-- CreateTable
CREATE TABLE "certa_mock_users" (
    "certaUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "lastTrainingDate" TEXT,
    "lastTrainingKind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certa_mock_users_pkey" PRIMARY KEY ("certaUserId")
);

-- CreateTable
CREATE TABLE "certa_mock_link_codes" (
    "code" TEXT NOT NULL,
    "certaUserId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certa_mock_link_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "certa_mock_flights" (
    "flightId" TEXT NOT NULL,
    "certaUserId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "locationIsIcao" BOOLEAN NOT NULL,
    "aircraft" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "missionType" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certa_mock_flights_pkey" PRIMARY KEY ("flightId")
);

-- CreateIndex
CREATE UNIQUE INDEX "certa_links_certaUserId_key" ON "certa_links"("certaUserId");

-- CreateIndex
CREATE INDEX "certa_shared_flights_discordUserId_idx" ON "certa_shared_flights"("discordUserId");

-- CreateIndex
CREATE INDEX "certa_mock_flights_certaUserId_date_idx" ON "certa_mock_flights"("certaUserId", "date");

-- CreateIndex
CREATE INDEX "certa_mock_flights_date_idx" ON "certa_mock_flights"("date");

