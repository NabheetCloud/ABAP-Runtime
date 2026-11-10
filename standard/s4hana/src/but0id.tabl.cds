@EndUserText.label : 'BP identification numbers'
define table but0id {
  key mandt           : abap.clnt not null;
  key partner         : abap.char(10) not null;
  key type            : abap.char(1) not null;
  key idnumber        : abap.char(60) not null;
  valid_date_from     : abap.char(20);
  valid_date_to       : abap.char(20);
  institute           : abap.char(20);
}
