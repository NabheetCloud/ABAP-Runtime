@EndUserText.label : 'Condition record header'
define table konh {
  key mandt   : abap.clnt not null;
  key knumh   : abap.char(10) not null;
  kschl       : abap.char(4);
  kotabnr     : abap.char(20);
  datab       : abap.dats;
  datbi       : abap.dats;
  vakey       : abap.char(20);
  kappl       : abap.char(2);
  erdat       : abap.dats;
  ernam       : abap.char(12);
  kvewe       : abap.char(1);
}
