@EndUserText.label : 'Statistical line items (asset)'
define table faat_doc_it {
  key mandt  : abap.clnt not null;
  key bukrs  : abap.char(4) not null;
  key anln1  : abap.char(12) not null;
  key anln2  : abap.char(4) not null;
  key gjahr  : abap.numc(4) not null;
  key awref  : abap.char(10) not null;
  key awitem : abap.numc(6) not null;
  key afabe  : abap.numc(2) not null;
  key subta  : abap.numc(6) not null;
  @Semantics.amount.currencyCode : 'faat_doc_it.waers'
  anbtr      : abap.curr(15,2);
  anbwa      : abap.char(3);
  budat      : abap.dats;
  waers      : abap.cuky;
}
