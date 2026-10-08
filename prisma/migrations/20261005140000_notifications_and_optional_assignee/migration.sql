-- Allow tasks to be created before they are assigned.
ALTER TABLE `Task` DROP FOREIGN KEY `Task_assigneeId_fkey`;
ALTER TABLE `Task` MODIFY `assigneeId` VARCHAR(191) NULL;
ALTER TABLE `Task` ADD CONSTRAINT `Task_assigneeId_fkey`
FOREIGN KEY (`assigneeId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `Task_deadline_idx` ON `Task`(`deadline`);
CREATE INDEX `Task_assigneeId_deadline_idx` ON `Task`(`assigneeId`, `deadline`);

CREATE TABLE `Notification` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` ENUM('TASK_ASSIGNED', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'GENERIC') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `taskId` VARCHAR(191) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `Notification_userId_readAt_idx`(`userId`, `readAt`),
    INDEX `Notification_taskId_idx`(`taskId`),
    UNIQUE INDEX `Notification_userId_kind_taskId_key`(`userId`, `kind`, `taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey`
FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `Notification` ADD CONSTRAINT `Notification_taskId_fkey`
FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
