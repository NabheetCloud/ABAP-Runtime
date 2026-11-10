@EndUserText.label : 'Billing documents'
define table zbil_head {
  key client      : abap.clnt not null;
  key billing_doc : abap.numc(10) not null;
  status          : abap.char(1);
  customer_name   : abap.char(40);
  street          : abap.char(40);
  postal_code     : abap.char(10);
  city            : abap.char(40);
  country         : abap.char(3);
  billing_date    : abap.dats;
  due_date        : abap.dats;
  currency        : abap.cuky;
  tax_rate        : abap.dec(5,2);
}
