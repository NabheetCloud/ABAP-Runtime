@EndUserText.label : 'Business partner roles'
define table but100 {
  key mandt      : abap.clnt not null;
  key partner    : abap.char(10) not null;
  key rltyp      : abap.char(6) not null;
  key dfval      : abap.char(30) not null;
  valid_from     : abap.dats;
  valid_to       : abap.dats;
  date_from      : abap.dats;
  time_from      : abap.tims;
  date_to        : abap.dats;
}
