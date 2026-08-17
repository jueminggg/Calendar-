-- CreateTable
CREATE TABLE "TelegramDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelegramDraft_userId_idx" ON "TelegramDraft"("userId");

-- AddForeignKey
ALTER TABLE "TelegramDraft" ADD CONSTRAINT "TelegramDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

