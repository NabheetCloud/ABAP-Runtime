@EndUserText.label : 'OM relationships'
define table hrp1001 {
  key mandt : abap.clnt not null;
  key otype : abap.char(2) not null;
  key objid : abap.char(8) not null;
  key plvar : abap.char(2) not null;
  key rsign : abap.char(1) not null;
  key relat : abap.char(3) not null;
  key istat : abap.char(5) not null;
  key priox : abap.numc(2) not null;
  key begda : abap.dats not null;
  key endda : abap.dats not null;
  key varyf : abap.char(20) not null;
  key seqnr : abap.numc(3) not null;
  sclas     : abap.char(2);
  sobid     : abap.char(45);
}
