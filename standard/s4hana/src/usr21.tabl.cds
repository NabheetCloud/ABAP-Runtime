@EndUserText.label : 'User ↔ address'
define table usr21 {
  key mandt      : abap.clnt not null;
  key bname      : abap.char(12) not null;
  persnumber     : abap.char(10);
  addrnumber     : abap.char(10);
  techdesc       : abap.char(20);
}
