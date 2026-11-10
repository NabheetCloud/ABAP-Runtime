@EndUserText.label : 'Organizational assignment'
define table pa0001 {
  key mandt : abap.clnt not null;
  key pernr : abap.char(8) not null;
  key subty : abap.char(4) not null;
  key objps : abap.char(2) not null;
  key sprps : abap.char(1) not null;
  key endda : abap.dats not null;
  key begda : abap.dats not null;
  key seqnr : abap.numc(3) not null;
  bukrs     : abap.char(4);
  werks     : abap.char(4);
  persg     : abap.char(1);
  persk     : abap.char(2);
  kostl     : abap.char(10);
  orgeh     : abap.char(8);
  plans     : abap.char(8);
  stell     : abap.char(8);
  btrtl     : abap.char(20);
  aedtm     : abap.dats;
  uname     : abap.char(12);
}
