@EndUserText.label : 'One-time account data'
define table bsec {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  key belnr : abap.char(10) not null;
  key gjahr : abap.numc(4) not null;
  key buzei : abap.numc(3) not null;
  name1     : abap.char(35);
  ort01     : abap.char(35);
  stras     : abap.char(35);
  bankn     : abap.char(18);
  land1     : abap.char(3);
  pstlz     : abap.char(10);
  spras     : abap.lang;
}
