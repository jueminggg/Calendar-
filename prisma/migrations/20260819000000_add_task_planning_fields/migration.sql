-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MED', 'HIGH');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "estimatedMinutes" INTEGER,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "priority" "Priority" NOT NULL DEFAULT 'MED';

