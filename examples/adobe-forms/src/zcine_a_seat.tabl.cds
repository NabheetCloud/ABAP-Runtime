@EndUserText.label : 'Cinema Demo - Seats'
define table zcine_a_seat {
  key client : abap.clnt not null;
  key id     : abap.raw(16) not null;
  roomid     : abap.raw(16);
  name       : abap.sstring(4);
  pricetier  : abap.int1;
}
