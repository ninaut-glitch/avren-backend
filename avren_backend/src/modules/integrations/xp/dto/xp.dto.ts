import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

export class LinkAccountDto {
  @IsUUID('4', { message: 'client_id deve ser um UUID valido.' })
  client_id!: string;
}

export class ListRunsQueryDto {
  @Type(() => Number)
  @IsInt({ message: 'limit deve ser um inteiro.' })
  @Min(1, { message: 'limit minimo e 1.' })
  @Max(100, { message: 'limit maximo e 100.' })
  limit: number = 20;
}
