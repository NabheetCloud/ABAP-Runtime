@EndUserText.label : 'Products (sales data)'
define table mvke {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key vkorg : abap.char(4) not null;
  key vtweg : abap.char(2) not null;
  dwerk     : abap.char(4);
  vrkme     : abap.unit(3);
  aumng     : abap.quan(13,3);
  mtpos     : abap.char(4);
  lvorm     : abap.char(1);
  ktgrm     : abap.char(20);
  @Semantics.quantity.unitOfMeasure : 'mvke.vrkme'
  scmng     : abap.quan(13,3);
  prodh     : abap.char(20);
  vmsta     : abap.char(20);
  vmstd     : abap.char(20);
  kondm     : abap.char(20);
}
