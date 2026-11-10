@EndUserText.label : 'Cinema Demo - Movies'
define table zcine_a_mov {
  key client  : abap.clnt not null;
  key id      : abap.raw(16) not null;
  title       : abap.sstring(1024);
  description : abap.sstring(1024);
  duration    : abap.int8;
  logo        : abap.rawstring(0);
}
