@EndUserText.label : 'Companies'
define table t880 {
  key mandt : abap.clnt not null;
  key rcomp : abap.char(6) not null;
  name1     : abap.char(30);
  cntry     : abap.char(3);
  curr      : abap.cuky;
}
