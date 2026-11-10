@EndUserText.label : 'GOS object relationships (attachments)'
define table srgbtbrel {
  key mandt    : abap.clnt not null;
  key brelguid : abap.char(32) not null;
  instid_a     : abap.char(70);
  typeid_a     : abap.char(32);
  instid_b     : abap.char(70);
  typeid_b     : abap.char(32);
  catid_a      : abap.char(20);
  catid_b      : abap.char(20);
  reltype      : abap.char(4);
  utctime      : abap.char(20);
}
