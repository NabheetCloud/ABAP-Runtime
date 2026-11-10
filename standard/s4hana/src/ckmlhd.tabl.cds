@EndUserText.label : 'Material ledger header'
define table ckmlhd {
  key mandt     : abap.clnt not null;
  key kalnr     : abap.char(12) not null;
  matnr         : abap.char(40);
  bwkey         : abap.char(4);
  bwtar         : abap.char(10);
  abrechdat     : abap.dats;
  mlast         : abap.char(20);
}
