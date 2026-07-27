import { IsIn } from 'class-validator';

export class UpdateConvictionDto {
  @IsIn(['quente', 'dream', null])
  conviction: 'quente' | 'dream' | null;
}
