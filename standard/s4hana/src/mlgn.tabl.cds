@EndUserText.label : 'Warehouse number data'
define table mlgn {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key lgnum : abap.char(3) not null;
  ltkze     : abap.char(20);
  ltkza     : abap.char(20);
  lhmg1     : abap.dec(13,3);
}
