@EndUserText.label : 'Cinema Demo - Rooms'
define table zcine_a_roo {
  key client : abap.clnt not null;
  key id     : abap.raw(16) not null;
  name       : abap.sstring(255);
  address    : abap.sstring(1024);
  zip        : abap.sstring(1024);
  country    : abap.sstring(1024);
}
