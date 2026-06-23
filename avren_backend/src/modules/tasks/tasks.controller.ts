import {
  Body, Controller, Get, Param, Patch,
  Post, Query, ParseUUIDPipe, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/create-task.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  private ctx(user: JwtPayload, req: any) {
    return req.rlsContext ?? {
      tenantId: user.tenantId, userId: user.sub, userRole: user.role,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Lista tasks do usuário com filtros' })
  findAll(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Query('status')     status?: string,
    @Query('priority')   priority?: string,
    @Query('due_before') due_before?: string,
    @Query('page')       page  = 1,
    @Query('limit')      limit = 20,
  ) {
    return this.service.findAll(this.ctx(user, req), {
      status, priority, due_before,
      page: Number(page), limit: Number(limit),
    });
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma nova task' })
  create(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Body() dto: CreateTaskDto,
  ) {
    return this.service.create(this.ctx(user, req), dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retorna task pelo ID' })
  findOne(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.findById(this.ctx(user, req), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza status ou dados da task' })
  update(
    @CurrentUser() user: JwtPayload, @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.service.update(this.ctx(user, req), id, dto);
  }
}
