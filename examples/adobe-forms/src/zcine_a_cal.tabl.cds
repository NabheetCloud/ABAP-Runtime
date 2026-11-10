@EndUserText.label : 'Cinema Demo - Schedule'
define table zcine_a_cal {
  key client : abap.clnt not null;
  key id     : abap.raw(16) not null;
  begindate  : abap.dats;
  enddate    : abap.dats;
  begintime  : abap.tims;
  endtime    : abap.tims;
  movieid    : abap.raw(16);
  roomid     : abap.raw(16);
}
