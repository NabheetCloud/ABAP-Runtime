@EndUserText.label : 'Invoices'
define table zinv_head {
  key client     : abap.clnt not null;
  key invoice_id : abap.numc(10) not null;
  customer       : abap.char(40);
  invoice_date   : abap.dats;
  currency       : abap.cuky;
}
