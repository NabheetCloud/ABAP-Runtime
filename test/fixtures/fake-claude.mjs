#!/usr/bin/env node
// Replays a Claude Code stream-json session (for UI testing): plan, two files typed out live, a check.
import fs from 'node:fs';
const out = o => process.stdout.write(JSON.stringify({ session_id: 'fake', ...o }) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms * Number(process.env.FAKE_SPEED ?? 1)));
const se = event => out({ type: 'stream_event', event, parent_tool_use_id: null });
let n = 0;
async function text(t) { se({ type: 'message_start' }); se({ type: 'content_block_start', index: 0, content_block: { type: 'text' } }); for (const w of t.split(/(?<= )/)) { se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: w } }); await sleep(40); } out({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } }); }
async function tool(name, input, result, live) {
  const id = 'tu' + n++;
  se({ type: 'message_start' });
  se({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } });
  const json = JSON.stringify(input);
  const step = live ? 18 : json.length;
  for (let i = 0; i < json.length; i += step) { se({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json.slice(i, i + step) } }); await sleep(live ? 35 : 0); }
  se({ type: 'content_block_stop', index: 0 });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  await sleep(300);
  if (name === 'Write') fs.writeFileSync(input.file_path, input.content);
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: result }] } });
}
const dir = process.cwd();
await sleep(1500);
await tool('Read', { file_path: 'examples/travel/src/zr_travel.bdef.asbdef' }, 'ok');
await tool('Bash', { command: 'ls examples/travel/src' }, 'ok');
await tool('TodoWrite', { todos: [{ content: 'Tables', status: 'in_progress' }, { content: 'CDS views', status: 'pending' }, { content: 'Behavior + ABAP', status: 'pending' }, { content: 'Service + Fiori app', status: 'pending' }] }, 'ok');
se({ type: 'message_start' });
se({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
for (const w of 'A task needs a UUID key, a due date and a status. The status determination defaults it to Open; a validation rejects due dates in the past.'.split(/(?<= )/)) { se({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: w } }); await sleep(60); }
se({ type: 'content_block_stop', index: 0 });
await text('Starting with the database table for the tasks.');
fs.mkdirSync(dir + '/src', { recursive: true });
await tool('Write', { file_path: dir + '/src/ztask_a.tabl.cds', content: `@EndUserText.label : 'Tasks'\ndefine table ztask_a {\n  key client  : abap.clnt not null;\n  key task_uuid : sysuuid_x16 not null;\n  title       : abap.char(80);\n  due_date    : abap.dats;\n  status      : abap.char(1);\n  created_by  : abp_creation_user;\n  created_at  : abp_creation_tstmpl;\n  local_last_changed_at : abp_locinst_lastchange_tstmpl;\n}\n` }, 'File created', true);
await tool('Write', { file_path: dir + '/src/zbp_r_task.clas.locals_imp.abap', content: `CLASS lhc_task DEFINITION INHERITING FROM cl_abap_behavior_handler.\n  PRIVATE SECTION.\n    METHODS setStatus FOR DETERMINE ON MODIFY\n      IMPORTING keys FOR Task~setStatus.\n    METHODS validateDueDate FOR VALIDATE ON SAVE\n      IMPORTING keys FOR Task~validateDueDate.\nENDCLASS.\n\nCLASS lhc_task IMPLEMENTATION.\n  METHOD setStatus.\n    " default every new task to Open\n    READ ENTITIES OF zr_task IN LOCAL MODE\n      ENTITY Task FIELDS ( Status ) WITH CORRESPONDING #( keys )\n      RESULT DATA(tasks).\n    MODIFY ENTITIES OF zr_task IN LOCAL MODE\n      ENTITY Task UPDATE FIELDS ( Status )\n      WITH VALUE #( FOR t IN tasks WHERE ( Status IS INITIAL )\n                    ( %tky = t-%tky Status = 'O' ) ).\n  ENDMETHOD.\n\n  METHOD validateDueDate.\n    READ ENTITIES OF zr_task IN LOCAL MODE\n      ENTITY Task FIELDS ( DueDate ) WITH CORRESPONDING #( keys )\n      RESULT DATA(tasks).\n    LOOP AT tasks INTO DATA(task) WHERE DueDate < cl_abap_context_info=>get_system_date( ).\n      APPEND VALUE #( %tky = task-%tky ) TO failed-task.\n      APPEND VALUE #( %tky = task-%tky\n                      %msg = new_message_with_text( text = 'Due date is in the past' ) ) TO reported-task.\n    ENDLOOP.\n  ENDMETHOD.\nENDCLASS.\n` }, 'File created', true);
await tool('Bash', { command: `node rap.js check .` }, 'Activated: 0 error(s)');
await sleep(800);
await text('Done: a task table and its behavior logic (demo replay).');
out({ type: 'result', is_error: false, total_cost_usd: 0, num_turns: 6 });
