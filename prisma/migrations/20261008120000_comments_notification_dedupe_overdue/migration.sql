-- Notification: a per-event dedupe key replaces the unique (userId, kind, taskId),
-- which allowed only one notification of each kind per task (blocking repeat
-- comments, re-assignments and reminders for a changed deadline).
-- MySQL may use the old unique index to back the userId foreign key, so the FK is
-- dropped first and re-created at the end.
ALTER TABLE `Notification` DROP FOREIGN KEY `Notification_userId_fkey`;

DROP INDEX `Notification_userId_kind_taskId_key` ON `Notification`;

ALTER TABLE `Notification` ADD COLUMN `dedupeKey` VARCHAR(191) NULL,
    MODIFY `kind` ENUM('TASK_ASSIGNED', 'TASK_UNASSIGNED', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'TASK_CANCELLED', 'TASK_UPDATED', 'TASK_SUBMITTED', 'TASK_COMMENT', 'GENERIC') NOT NULL;

-- Backfill existing rows. Overdue rows get the same key the reminder job now uses
-- ("overdue:<taskId>:<deadline in ms>") so workers are not notified twice;
-- everything else gets a unique legacy key.
UPDATE `Notification` n
LEFT JOIN `Task` t ON t.`id` = n.`taskId`
SET n.`dedupeKey` = CASE
    WHEN n.`kind` = 'TASK_OVERDUE' AND t.`deadline` IS NOT NULL
        THEN CONCAT('overdue:', n.`taskId`, ':', TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', t.`deadline`) DIV 1000)
    ELSE CONCAT('legacy:', n.`kind`, ':', COALESCE(n.`taskId`, n.`id`))
END;

ALTER TABLE `Notification` MODIFY `dedupeKey` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Notification_userId_dedupeKey_key` ON `Notification`(`userId`, `dedupeKey`);

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE `Task` ADD COLUMN `markedOverdueAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `TaskComment` (
    `id` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `body` VARCHAR(1000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TaskComment_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TaskComment` ADD CONSTRAINT `TaskComment_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskComment` ADD CONSTRAINT `TaskComment_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
