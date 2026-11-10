@EndUserText.label : 'Notes'
define table znote_a {
  key client  : abap.clnt not null;
  key note_id : abap.char(10) not null;
  text        : abap.char(200);
  changed_at  : abp_locinst_lastchange_tstmpl;
}
