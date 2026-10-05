import { IsNotEmpty, IsString } from 'class-validator';

export class AssignTaskDto {
  @IsString()
  @IsNotEmpty()
  assigneeId!: string;
}