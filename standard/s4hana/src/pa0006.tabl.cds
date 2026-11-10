@EndUserText.label : 'Addresses'
define table pa0006 {
  key mandt : abap.clnt not null;
  key pernr : abap.char(8) not null;
  key subty : abap.char(4) not null;
  key objps : abap.char(2) not null;
  key sprps : abap.char(1) not null;
  key endda : abap.dats not null;
  key begda : abap.dats not null;
  key seqnr : abap.numc(3) not null;
  anssa     : abap.char(20);
  stras     : abap.char(35);
  ort01     : abap.char(35);
  pstlz     : abap.char(10);
  land1     : abap.char(3);
  regio     : abap.char(3);
  aedtm     : abap.dats;
  uname     : abap.char(12);
}
