-- CreateTable
CREATE TABLE "ops_server_resources" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_server_resources_pkey" PRIMARY KEY ("key")
);

