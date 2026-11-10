@EndUserText.label : 'Customer'
define table zcustomer_a {
  key client      : abap.clnt not null;
  key customer_id : abap.numc(6) not null;
  first_name      : abap.char(40);
  last_name       : abap.char(40);
  city            : abap.char(40);
  country_code    : abap.char(3);
  email           : abap.char(256);
}
