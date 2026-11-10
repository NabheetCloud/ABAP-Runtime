@EndUserText.label : 'Work center ↔ cost center'
define table crco {
  key mandt : abap.clnt not null;
  key objty : abap.char(2) not null;
  key objid : abap.char(8) not null;
  key laset : abap.numc(6) not null;
  key endda : abap.dats not null;
  key lanum : abap.numc(4) not null;
  kostl     : abap.char(10);
  lstar     : abap.char(6);
  begda     : abap.dats;
  kokrs     : abap.char(4);
}
