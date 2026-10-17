-- AlterTable
ALTER TABLE `Notification` MODIFY `kind` ENUM('TASK_ASSIGNED', 'TASK_REASSIGNED', 'TASK_UNASSIGNED', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'TASK_CANCELLED', 'TASK_UPDATED', 'TASK_SUBMITTED', 'TASK_COMMENT', 'DAILY_SUMMARY', 'SIGNUP_REQUEST', 'GENERIC') NOT NULL;

-- CreateTable
CREATE TABLE `SignupRequest` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `lang` VARCHAR(191) NOT NULL DEFAULT 'en',
    `status` ENUM('UNVERIFIED', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'UNVERIFIED',
    `codeHash` VARCHAR(191) NULL,
    `codeExpiresAt` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `verifiedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `rejectionReason` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SignupRequest_email_createdAt_idx`(`email`, `createdAt`),
    INDEX `SignupRequest_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SignupRequest` ADD CONSTRAINT `SignupRequest_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
