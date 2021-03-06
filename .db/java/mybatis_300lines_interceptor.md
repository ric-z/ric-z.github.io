### 前提

  数据库表名、字段名均采用蛇形命名（即以下划线分隔单词）。
  Java 类名、字段名均采用驼峰命名。
  **要求 Java - 数据库之间能互相转换。如果不能转换也不用急，可以调整部分代码，建议在PO类上添加注解进行映射）**

### 原理

  配置一个 mybatis **Interceptor**，利用 Mapper 接口中方法的声明来动态生成 SQL。
  任何加了这些注解的方法都会进入拦截器：@Insert("C")、@Update("U")、@Select("R")、@Delete("D")

### 使用

  建立测试表

```sql
CREATE TABLE `test_curd` (
  `id` int(8) NOT NULL AUTO_INCREMENT,
  `name` varchar(50) DEFAULT NULL,
  `age` tinyint(3) DEFAULT NULL,
  `insert_time` timestamp NULL DEFAULT NULL,
  `update_time` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8
```



加上 CURD 对应的四个标签就会进入拦截器生成 SQL 的方法。
方法名要满足类似如下这样的格式：
  getByField1AndField2...
  listByField1AndField2AndField3...
  updateField1AndField2...
  deleteByField1AndField2...
只是 update 的话必须用注解指定 keyProperty，如果不愿意这样做可以调整拦截器代码。这样 update 的方法就写成 updateField1AndField2ByField3AndField4 这样。

为了方便，先定义一个基本 Mapper 作为父接口

```java
package com.demo.web.mapper;

import org.apache.ibatis.annotations.*;

/**
 * 继承此接口则自动实现增删改查操作
 **/
public interface BaseMapper<T> {

    @Insert("C")
    // 开启自增长 id 回填，“id” 是主键字段名
    @Options(useGeneratedKeys = true, keyProperty = "id")
    void insert(T bean);

    /**
     * 更新所有字段
     **/
    @Update("U")
    // 根据字段 “id” 查找，根据实际需要修改
    @Options(keyProperty = "id")
    int updateAllFields(T bean);

    /**
     * 更新指定的字段
     **/
    @Update("U")
    @Options(keyProperty = "id")
    int updateFields(T bean, String... fields);

    @Select("R")
    T getById(Number id);

    /**
     * 根据 id 删除，返回受影响行数
     */
    @Delete("D")
    int deleteById(T bean);
}

```

  定义针对某个表的 Mapper

```java
package com.demo.web.mapper;

import com.demo.web.model.po.TestCurdPO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
@Mapper
public interface TestCurdMapper extends BaseMapper<TestCurdPO> {

    @Select("R")
    TestCurdPO getByNameAndAge(String name, Integer age);

    @Select("R")
    List<TestCurdPO> listByAge(Integer age);

    @Update("U")
    @Options(keyProperty = "id")
    void updateNameAndAge(TestCurdPO bean);
}

```



### 代码

mybatis-config.xml 配置

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE configuration PUBLIC "-//mybatis.org//DTD Config 3.0//EN" "http://mybatis.org/dtd/mybatis-3-config.dtd">
<configuration>
  <settings>
    <!-- 蛇形转驼峰 -->
    <setting name="mapUnderscoreToCamelCase" value="true"/>
  </settings>

  <plugins>
    <plugin interceptor="com.demo.framework.mybatis.DynamicSQLInterceptor">
      <!-- 使用默认值（参与预编译）格式："C|U"."db column Name" -->
      <property name="C.insert_time" value="CURRENT_TIMESTAMP"/>
      <property name="C.update_time" value="CURRENT_TIMESTAMP"/>
      <property name="U.insert_time" value="CURRENT_TIMESTAMP"/>
      <property name="U.update_time" value="CURRENT_TIMESTAMP"/>
        <!-- 设置警告时长（毫秒） -->
      <property name="debug" value="0"/>
      <property name="info" value="100"/>
      <property name="warn" value="1000"/>
    </plugin>
  </plugins>
</configuration>
```

DynamicSQLInterceptor.java 源码

```java
package com.demo.framework.mybatis;

import lombok.extern.slf4j.Slf4j;
import org.apache.ibatis.executor.Executor;
import org.apache.ibatis.jdbc.SQL;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.mapping.SqlSource;
import org.apache.ibatis.plugin.*;
import org.apache.ibatis.scripting.defaults.RawSqlSource;
import org.apache.ibatis.session.ResultHandler;
import org.apache.ibatis.session.RowBounds;
import org.springframework.util.Assert;
import org.springframework.util.ReflectionUtils;

import java.lang.reflect.Modifier;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Slf4j
@Intercepts({@Signature(type = Executor.class, method = "update", args = {MappedStatement.class, Object.class}),
             @Signature(type = Executor.class, method = "query", args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class})})
public class DynamicSQLInterceptor implements Interceptor {

    private Map<String, String> insertValues = new HashMap<String, String>(5);
    private Map<String, String> updateValues = new HashMap<String, String>(3);
    private int debugTime = 0;
    private int infoTime = 100;
    private int warnTime = 1000;

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        long currentTimeMillis = System.currentTimeMillis();
        final Object[] args = invocation.getArgs();
        MappedStatement ms = (MappedStatement) args[0];
        SqlSource sqlSource = ms.getSqlSource();
        try {
            if (!(sqlSource instanceof RawSqlSource)) {
                return invocation.proceed();
            }
            final Object param = args[1];
            String sql = buildSql(ms, sqlSource, param);
            if (sql != null) {
                // 重新设置 MappedStatement，使新 sql 生效
                SqlSource newSqlSource = new RawSqlSource(ms.getConfiguration(), sql, param.getClass());
                args[0] = copyFromMappedStatement(ms, newSqlSource);
            }
            return invocation.proceed();
        } finally {
            long l = System.currentTimeMillis() - currentTimeMillis;
            if (l >= warnTime) {
                log.warn("{} ms used to execute this sql id: {}", l, ms.getId());
            } else if (l >= infoTime) {
                log.info("{} ms used to execute this sql id: {}", l, ms.getId());
            } else if (l >= debugTime) {
                log.debug("{} ms used to execute this sql id: {}", l, ms.getId());
            }
        }
    }

    /**
     * 创建 CURD 四类 SQL
     **/
    private String buildSql(MappedStatement ms, SqlSource sqlSource, Object param) {
        String sql;
        final String mapperId = ms.getId().replaceAll("^.*\\.(.*?)$", "$1");
        switch (sqlSource.getBoundSql(null).getSql()) {
            case "C":
                Assert.notNull(param, "arg can't be null.");
                sql = buildCreatSql(param.getClass(), ms.getKeyProperties());
                break;
            case "U":
                if ("updateAllFields".equals(mapperId)) {
                    sql = buildUpdateSql(param.getClass(), ms.getKeyProperties());
                } else if ("updateFields".equals(mapperId)) {
                    // 此时需更新的字段以变长参数传入，即存在两个参数，第一个为 PO 实例，第二个为字段名数组
                    Map<String, ?> map = (Map<String, ?>) param;
                    Object bean = map.get("param1");
                    Assert.notNull(bean, "arg can't be null.");
                    String[] fieldNames = (String[]) map.get("param2");
                    Assert.notEmpty(fieldNames, "field names can't be empty.");
                    sql = buildUpdateSql2(bean.getClass(), ms.getKeyProperties(), Arrays.asList(fieldNames));
                } else {
                    Assert.isTrue(mapperId.matches("^update[A-Z]\\w*?(And[A-Z]\\w*?)*$"), "your method name should like: updateField1AndField2");
                    final String[] fields = mapperId.substring(6).split("And");
                    final List<String> objects = Arrays.stream(fields).map(f -> humpToLine(f).substring(1)).collect(Collectors.toList());
                    sql = buildUpdateSql1(param.getClass(), ms.getKeyProperties(), objects);
                }
                break;
            case "R":
                Assert.isTrue(mapperId.matches("^((get)|(list))By[A-Z]\\w*?(And[A-Z]\\w*?)*$"), "your method name should like: [get|list]ByField1AndField2");
                final String[] fields = mapperId.replaceFirst("((get)|(list))By", "").split("And");
                final List<String> objects = Arrays.stream(fields).map(f -> humpToLine(f).substring(1)).collect(Collectors.toList());
                Class<?> resultType = ms.getResultMaps().get(0).getType();
                sql = buildSelectSql(resultType, objects);
                break;
            case "D":
                Assert.isTrue(mapperId.matches("^deleteBy[A-Z]\\w*?(And[A-Z]\\w*?)*$"), "your method name should like: deleteByField1AndField2");
                final String[] fields1 = mapperId.substring(8).split("And");
                final List<String> objects2 = Arrays.stream(fields1).map(f -> humpToLine(f).substring(1)).collect(Collectors.toList());
                sql = buildDeleteSql(param.getClass(), objects2);
                break;
            default:
                sql = null;
                break;
        }
        return sql;
    }

    /**
     * 驼峰转蛇形，代码源于网络
     **/
    private static String humpToLine(String str) {
        Pattern humpPattern = Pattern.compile("[A-Z]");
        Matcher matcher = humpPattern.matcher(str);
        StringBuffer sb = new StringBuffer();
        while (matcher.find()) {
            matcher.appendReplacement(sb, "_" + matcher.group(0).toLowerCase());
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    private String buildCreatSql(Class<?> poClass, String[] keyProperties) {
        SQL sqlBuilder = new SQL();
        final String tableName = humpToLine(poClass.getSimpleName()).replaceAll("^_(.*?)_p_o$", "$1");
        sqlBuilder.INSERT_INTO('`' + tableName + '`');
        ReflectionUtils.doWithFields(poClass, (field) -> {
            // 忽略静态属性
            if (Modifier.isStatic(field.getModifiers())) {
                return;
            }
            String columnName = humpToLine(field.getName());
            if (Arrays.stream(keyProperties).anyMatch(columnName::equalsIgnoreCase)) {
                // 自动增长的字段不参与 insert
                return;
            }
            if (insertValues.containsKey(columnName)) {
                sqlBuilder.VALUES('`' + columnName + '`', insertValues.get(columnName));
            } else {
                sqlBuilder.VALUES('`' + columnName + '`', "#{" + field.getName() + '}');
            }
        });
        return sqlBuilder.toString();
    }

    private String buildUpdateSql(Class<?> poClass, String[] keyProperties) {
        SQL sqlBuilder = new SQL();
        final String tableName = humpToLine(poClass.getSimpleName()).replaceAll("^_(.*?)_p_o$", "$1");
        sqlBuilder.UPDATE('`' + tableName + '`');
        ReflectionUtils.doWithFields(poClass, (field) -> {
            // 忽略静态属性
            if (Modifier.isStatic(field.getModifiers())) {
                return;
            }
            String columnName = humpToLine(field.getName());
            if (Arrays.stream(keyProperties).anyMatch(columnName::equalsIgnoreCase)) {
                sqlBuilder.WHERE(String.format("`%s` = #{%s}", columnName, field.getName()));
            } else {
                if (updateValues.containsKey(columnName)) {
                    sqlBuilder.SET(String.format("`%s` = %s", columnName, updateValues.get(columnName)));
                } else {
                    sqlBuilder.SET(String.format("`%s` = #{%s}", columnName, field.getName()));
                }
            }
        });
        return sqlBuilder.toString();
    }

    private String buildUpdateSql1(Class<?> poClass, String[] keyProperties, List<String> fieldNames) {
        SQL sqlBuilder = new SQL();
        final String tableName = humpToLine(poClass.getSimpleName()).replaceAll("^_(.*?)_p_o$", "$1");
        sqlBuilder.UPDATE('`' + tableName + '`');
        for (String fieldname : fieldNames) {
            String columnName = humpToLine(fieldname);
            if (Arrays.stream(keyProperties).anyMatch(columnName::equalsIgnoreCase)) {
                sqlBuilder.WHERE(String.format("`%s` = #{%s}", columnName, fieldname));
            } else {
                if (updateValues.containsKey(columnName)) {
                    sqlBuilder.SET(String.format("`%s` = %s", columnName, updateValues.get(columnName)));
                } else {
                    sqlBuilder.SET(String.format("`%s` = #{%s}", columnName, fieldname));
                }
            }
        }
        return sqlBuilder.toString();
    }

    private String buildUpdateSql2(Class<?> poClass, String[] keyProperties, List<String> fieldNames) {
        SQL sqlBuilder = new SQL();
        final String tableName = humpToLine(poClass.getSimpleName()).replaceAll("^_(.*?)_p_o$", "$1");
        sqlBuilder.UPDATE('`' + tableName + '`');
        for (String fieldname : fieldNames) {
            String columnName = humpToLine(fieldname);
            if (Arrays.stream(keyProperties).anyMatch(columnName::equalsIgnoreCase)) {
                sqlBuilder.WHERE(String.format("`%s` = #{param1.%s}", columnName, fieldname));
            } else {
                if (updateValues.containsKey(columnName)) {
                    sqlBuilder.SET(String.format("`%s` = %s", columnName, updateValues.get(columnName)));
                } else {
                    sqlBuilder.SET(String.format("`%s` = #{param1.%s}", columnName, fieldname));
                }
            }
        }
        return sqlBuilder.toString();
    }

    private String buildSelectSql(Class<?> poClass, List<String> keyProperties) {
        SQL sqlBuilder = new SQL();
        final String tableName = humpToLine(poClass.getSimpleName()).replaceAll("^_(.*?)_p_o$", "$1");
        sqlBuilder.FROM('`' + tableName + '`');
        ReflectionUtils.doWithFields(poClass, (field) -> {
            // 忽略静态属性
            if (Modifier.isStatic(field.getModifiers())) {
                return;
            }
            String columnName = humpToLine(field.getName());
            sqlBuilder.SELECT(columnName);
        });
        for (int i = 0; i < keyProperties.size(); i++) {
            String fieldName = keyProperties.get(i);
            sqlBuilder.WHERE(String.format("`%s` = #{param%d}", humpToLine(fieldName), i + 1));
        }
        return sqlBuilder.toString();
    }

    private String buildDeleteSql(Class<?> poClass, List<String> keyProperties) {
        SQL sqlBuilder = new SQL();
        final String tableName = humpToLine(poClass.getSimpleName()).replaceAll("^_(.*?)_p_o$", "$1");
        sqlBuilder.DELETE_FROM('`' + tableName + '`');
        for (String fieldName : keyProperties) {
            sqlBuilder.WHERE(String.format("`%s` = #{%s}", humpToLine(fieldName), fieldName));
        }
        return sqlBuilder.toString();
    }

    private MappedStatement copyFromMappedStatement(MappedStatement ms, SqlSource newSqlSource) {
        MappedStatement.Builder builder = new MappedStatement.Builder(ms.getConfiguration(), ms.getId(), newSqlSource, ms.getSqlCommandType());
        builder.resource(ms.getResource());
        builder.fetchSize(ms.getFetchSize());
        builder.statementType(ms.getStatementType());
        builder.keyGenerator(ms.getKeyGenerator());
        if (ms.getKeyProperties() != null && ms.getKeyProperties().length > 0) {
            builder.keyProperty(ms.getKeyProperties()[0]);
        }
        builder.timeout(ms.getTimeout());
        builder.parameterMap(ms.getParameterMap());
        builder.resultMaps(ms.getResultMaps());
        builder.resultSetType(ms.getResultSetType());
        builder.cache(ms.getCache());
        builder.flushCacheRequired(ms.isFlushCacheRequired());
        builder.useCache(ms.isUseCache());
        return builder.build();
    }

    @Override
    public Object plugin(Object target) {
        if (target instanceof Executor) {
            return Plugin.wrap(target, this);
        } else {
            return target;
        }
    }

    @Override
    public void setProperties(Properties properties) {
        for (Map.Entry<Object, Object> entry : properties.entrySet()) {
            String key = entry.getKey().toString();
            if ("debug".equalsIgnoreCase(key)) {
                debugTime = Integer.parseInt(entry.getValue().toString());
                continue;
            } else if ("info".equalsIgnoreCase(key)) {
                infoTime = Integer.parseInt(entry.getValue().toString());
                continue;
            } else if ("warn".equalsIgnoreCase(key)) {
                warnTime = Integer.parseInt(entry.getValue().toString());
                continue;
            }
            String string = key.substring(2);
            if (key.startsWith("C.")) {
                insertValues.put(string, entry.getValue().toString());
            } else if (key.startsWith("U.")) {
                updateValues.put(string, entry.getValue().toString());
            }
        }
    }
}

```
