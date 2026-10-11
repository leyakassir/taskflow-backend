import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SaveLegalPageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  /** HTML from the admin editor; cleaned on the server before it's saved. */
  @IsString()
  @MaxLength(200_000)
  body!: string;
}
