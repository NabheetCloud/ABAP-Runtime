PROCESS BEFORE OUTPUT.
  MODULE status_0100.
  LOOP AT gt_items INTO gs_item WITH CONTROL tc_items
    CURSOR tc_items-current_line.
  ENDLOOP.

PROCESS AFTER INPUT.
  MODULE exit_0100 AT EXIT-COMMAND.
  LOOP AT gt_items.
    MODULE modify_item.
  ENDLOOP.
  CHAIN.
    FIELD gs_head-lifnr MODULE check_vendor ON REQUEST.
  ENDCHAIN.
  MODULE user_command_0100.
