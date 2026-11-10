@EndUserText.label : 'Workflow work item header'
define table swwwihead {
  key mandt      : abap.clnt not null;
  key wi_id      : abap.char(12) not null;
  wi_type        : abap.char(1);
  wi_stat        : abap.char(12);
  wi_cd          : abap.dats;
  wi_ct          : abap.tims;
  wi_aagent      : abap.char(20);
  top_wi_id      : abap.char(20);
  wi_creator     : abap.char(20);
  wi_prio        : abap.int4;
  wi_rh_task     : abap.char(20);
  wi_text        : abap.char(120);
}
