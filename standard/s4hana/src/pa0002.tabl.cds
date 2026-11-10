@EndUserText.label : 'Personal data'
define table pa0002 {
  key mandt : abap.clnt not null;
  key pernr : abap.char(8) not null;
  key subty : abap.char(4) not null;
  key objps : abap.char(2) not null;
  key sprps : abap.char(1) not null;
  key endda : abap.dats not null;
  key begda : abap.dats not null;
  key seqnr : abap.numc(3) not null;
  nachn     : abap.char(40);
  vorna     : abap.char(40);
  gbdat     : abap.dats;
  gesch     : abap.char(20);
  natio     : abap.char(20);
  sprsl     : abap.lang;
  aedtm     : abap.dats;
  uname     : abap.char(12);
}
