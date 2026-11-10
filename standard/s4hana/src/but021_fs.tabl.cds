@EndUserText.label : 'BP address usages'
define table but021_fs {
  key mandt      : abap.clnt not null;
  key partner    : abap.char(10) not null;
  key adr_kind   : abap.char(10) not null;
  key valid_to   : abap.dats not null;
  addrnumber     : abap.char(10);
  valid_from     : abap.dats;
}
