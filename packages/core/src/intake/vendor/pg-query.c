#include "pg_query.h"
#include <stdlib.h>
#include <string.h>
char *parse_sql(const char *query, int mode) {
  PgQueryParseResult result = pg_query_parse_opts(query, mode);
  char *output = result.error ? NULL : strdup(result.parse_tree);
  pg_query_free_parse_result(result);
  return output;
}
char *parse_plpgsql(const char *query) {
  PgQueryPlpgsqlParseResult result = pg_query_parse_plpgsql(query);
  char *output = result.error ? NULL : strdup(result.plpgsql_funcs);
  pg_query_free_plpgsql_parse_result(result);
  return output;
}
