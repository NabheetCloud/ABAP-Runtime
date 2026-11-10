@EndUserText.label : 'Decimal places of currencies'
define table tcurx {
  key mandt   : abap.clnt not null;
  key currkey : abap.cuky not null;
  currdec     : abap.int1;
}
