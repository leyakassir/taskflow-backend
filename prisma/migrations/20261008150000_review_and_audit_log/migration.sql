-- AlterTable
ALTER TABLE `Task` ADD COLUMN `reviewNote` TEXT NULL,
    ADD COLUMN `reviewStatus` ENUM('PENDING', 'APPROVED', 'CHANGES_REQUESTED') NULL,
    ADD COLUMN `reviewedAt` DATETIME(3) NULL,
    ADD COLUMN `reviewedById` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `action` ENUM('TASK_CREATED', 'TASK_UPDATED', 'TASK_REASSIGNED', 'TASK_STARTED', 'TASK_STATUS_CHANGED', 'TASK_CANCELLED', 'TASK_SUBMITTED', 'TASK_APPROVED', 'TASK_SENT_BACK', 'CHECKLIST_ITEM_ADDED', 'CHECKLIST_ITEM_RENAMED', 'CHECKLIST_ITEM_REMOVED', 'ATTACHMENT_UPLOADED', 'ATTACHMENT_REMOVED', 'USER_CREATED', 'USER_UPDATED', 'USER_PASSWORD_RESET', 'USER_PASSWORD_CHANGED', 'USER_ACTIVATED', 'USER_DEACTIVATED') NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `taskId` VARCHAR(191) NULL,
    `targetUserId` VARCHAR(191) NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_taskId_createdAt_idx`(`taskId`, `createdAt`),
    INDEX `AuditLog_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `AuditLog_targetUserId_createdAt_idx`(`targetUserId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_targetUserId_fkey` FOREIGN KEY (`targetUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
