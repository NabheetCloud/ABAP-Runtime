@EndUserText.label : 'Condition record items'
define table konp {
  key mandt    : abap.clnt not null;
  key knumh    : abap.char(10) not null;
  key kopos    : abap.numc(2) not null;
  kschl        : abap.char(4);
  kbetr        : abap.dec(15,3);
  konwa        : abap.cuky;
  kpein        : abap.dec(15,3);
  kmein        : abap.unit(3);
  loevm_ko     : abap.char(20);
}
