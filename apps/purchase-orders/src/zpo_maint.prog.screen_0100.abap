PROCESS BEFORE OUTPUT.
  MODULE status_0100.
  MODULE tc_items_lines.
  LOOP AT gt_items INTO gs_item WITH CONTROL tc_items
    CURSOR tc_items-current_line.
  ENDLOOP.

PROCESS AFTER INPUT.
  MODULE exit_0100 AT EXIT-COMMAND.
  LOOP AT gt_items.
    MODULE modify_tc_items.
  ENDLOOP.
  MODULE user_command_0100.
