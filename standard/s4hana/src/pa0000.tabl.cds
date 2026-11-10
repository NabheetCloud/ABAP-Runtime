@EndUserText.label : 'Actions'
define table pa0000 {
  key mandt : abap.clnt not null;
  key pernr : abap.char(8) not null;
  key subty : abap.char(4) not null;
  key objps : abap.char(2) not null;
  key sprps : abap.char(1) not null;
  key endda : abap.dats not null;
  key begda : abap.dats not null;
  key seqnr : abap.numc(3) not null;
  massn     : abap.char(2);
  massg     : abap.char(2);
  stat2     : abap.char(1);
  aedtm     : abap.dats;
  uname     : abap.char(12);
}
