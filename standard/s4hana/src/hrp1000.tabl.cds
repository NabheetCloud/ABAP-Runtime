@EndUserText.label : 'OM objects'
define table hrp1000 {
  key mandt : abap.clnt not null;
  key plvar : abap.char(2) not null;
  key otype : abap.char(2) not null;
  key objid : abap.char(8) not null;
  key istat : abap.char(5) not null;
  key begda : abap.dats not null;
  key endda : abap.dats not null;
  key langu : abap.lang not null;
  key seqnr : abap.numc(3) not null;
  short     : abap.char(20);
  stext     : abap.char(40);
}
