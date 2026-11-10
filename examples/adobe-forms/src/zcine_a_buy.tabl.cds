@EndUserText.label : 'Cinema Demo - Tickets'
define table zcine_a_buy {
  key client  : abap.clnt not null;
  key id      : abap.raw(16) not null;
  scheduleid  : abap.raw(16);
  seatid      : abap.raw(16);
  pricingtier : abap.int1;
  currency    : abap.cuky(5);
  pdf         : abap.rawstring(0);
  rendered    : abap_boolean;
}
